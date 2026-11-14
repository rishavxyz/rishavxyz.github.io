# Demystifying Binary Executables: A Developer's Guide to ELF and Mach-O

Every modern software engineer interacts with compiled binaries daily. Whether you are running `git`, deploying a Go or Rust microservice, compiling a C++ native extension for Node.js or Bun, or executing a shell utility on Linux or macOS, you are executing machine code packed inside an operating system binary.

Yet to many developers, a compiled binary file is an impenetrable black box of arbitrary hexadecimal bytes. When a program fails with `Segmentation fault`, `relocation error: symbol not found`, or `Exec format error`, debugging feels impossible without understanding binary structure.

In this guide, we will dissect executable binaries from the ground up: file headers, sections versus segments, symbol tables, dynamic linkage, and the command-line tools (`readelf`, `objdump`, `nm`, and `strings`) used to inspect and reverse-engineer them.

---

## 1. Magic Bytes and File Headers

Every executable binary begins with an identifying header known as **Magic Numbers** or magic bytes. When you invoke an executable via a shell, the kernel's `execve` system call reads the first few bytes of the file to identify the appropriate binary loader:

- **Linux & BSD (ELF):** `7F 45 4C 46` (`.ELF`)
- **macOS & iOS (Mach-O):** `CF FA ED FE` or `FE ED FA CF` (architecture dependent)
- **Windows (PE):** `4D 5A` (`MZ` — initials of DOS architect Mark Zbikowski)

### Dissecting an ELF Header on Linux

Let's look at the first 16 bytes of any Linux binary using `xxd`:

```bash
$ xxd -l 16 /bin/ls
00000000: 7f45 4c46 0201 0100 0000 0000 0000 0000  .ELF............
```

What do these initial bytes communicate to the Linux kernel?

- `7f 45 4c 46`: The standard ELF magic sequence.
- `02`: Class. `01` means 32-bit architecture; `02` means 64-bit architecture.
- `01`: Endianness. `01` means Little-Endian (LSB); `02` means Big-Endian (MSB).
- `01`: ELF version (always `01` for original ELF version).
- `00`: Target Operating System ABI (`00` for System V / generic Linux).

Using `readelf -h`, we can print the entire parsed ELF header:

```bash
$ readelf -h /bin/ls
ELF Header:
  Magic:   7f 45 4c 46 02 01 01 00 00 00 00 00 00 00 00 00 
  Class:                             ELF64
  Data:                              2's complement, little endian
  Version:                           1 (current)
  OS/ABI:                            UNIX - System V
  Type:                              DYN (Position-Independent Executable file)
  Machine:                           Advanced Micro Devices X86-64
  Entry point address:               0x6710
  Start of program headers:          64 (bytes into file)
  Start of section headers:          136808 (bytes into file)
  Size of this header:               64 (bytes)
  Number of program headers:         13
  Number of section headers:         31
```

Notice the **Entry point address** (`0x6710`). This is where the CPU instruction pointer (`RIP`) jumps once the OS loads the binary into memory. Note that execution does **not** begin at `main()`; it begins at `_start`, a bootstrap routine provided by the C runtime (`crt1.o`) that initializes standard input/output streams, environment variables, and memory allocators before invoking `main`.

---

## 2. The Dual Views: Sections vs Segments

An executable binary exists in two distinct contexts:

1. **At Link Time (Compiling and Linking):** The compiler and linker view the binary as a collection of **Sections**.
2. **At Run Time (Execution):** The operating system kernel loader views the binary as a collection of **Segments** described by **Program Headers**.

The operating system maps individual sections into memory segments based on permissions:

- Executable instructions (`.text`) and constants (`.rodata`) are grouped into a **Read + Execute** segment (`PT_LOAD`).
- Writable data (`.data`, `.bss`) is grouped into a **Read + Write** segment (`PT_LOAD`) with execution disabled for security (W^X protection).
- Metadata (`.symtab`, `.strtab`) is not loaded into memory and can be stripped for smaller binaries.

### The Crucial Sections

- **`.text`:** Compiled executable machine instructions (Read / Execute).
- **`.rodata`:** Read-only data like string literals and constants (Read Only).
- **`.data`:** Initialized global and static variables with initial values saved on disk (Read / Write).
- **`.bss`:** Uninitialized global variables — takes **0 bytes on disk** and is allocated as zero-filled pages in RAM at startup.
- **`.symtab` / `.strtab`:** Symbol and string tables mapping function and variable names to binary offsets (strippable).

#### Why `.bss` Matters

If you declare an uninitialized array of 100 megabytes in C (`char cache[100 * 1024 * 1024];`), your compiled binary on disk will **not** grow by 100MB. Instead, the linker records a single entry in `.bss` specifying: _"Allocate 100MB of zero-filled memory when this program loads."_

---

## 3. The Hands-On Tooling Arsenal

Let's write a simple program in C, compile it, and dissect it using standard CLI utilities:

```c
// demo.c
#include <stdio.h>

const char greeting[] = "Hello from binary!";
int global_counter = 100;
int uninitialized_slot;

int add(int a, int b) {
    return a + b;
}

int main() {
    int result = add(global_counter, 5);
    printf("%s %d\n", greeting, result);
    return 0;
}
```

Compile with debug symbols enabled:

```bash
$ gcc -O0 -g demo.c -o demo
```

### 1. `file`: High-Level Binary Triage

```bash
$ file demo
demo: ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, for GNU/Linux 3.2.0, with debug_info, not stripped
```

Key insights revealed:

- `pie executable`: Position Independent Executable (supports ASLR memory randomization).
- `dynamically linked`: Relies on external shared libraries (e.g., `libc.so.6`).
- `interpreter`: The exact path to the dynamic loader (`ld-linux`).
- `not stripped`: Function names and symbol maps remain intact inside the binary.

### 2. `readelf -S`: Listing All Sections

```bash
$ readelf -S demo
There are 31 section headers, starting at offset 0x3678:

Section Headers:
  [Nr] Name              Type             Address           Offset
  [14] .text             PROGBITS         0000000000001150  00001150
  [16] .rodata           PROGBITS         0000000000002000  00002000
  [24] .data             PROGBITS         0000000000004018  00003018
  [25] .bss              NOBITS           0000000000004028  00003028
```

Notice `.bss` has type `NOBITS`—it occupies memory at runtime (`0x00004028`), but takes zero byte space on disk.

### 3. `strings`: Extracting Text Strings

Before opening a binary in a disassembler, `strings` quickly reveals human-readable strings, API endpoints, error messages, and version watermarks:

```bash
$ strings demo | grep "Hello"
Hello from binary!
```

### 4. `nm`: Querying the Symbol Table

`nm` lists symbols (functions, global variables, and external imports):

```bash
$ nm demo
000000000004018 D global_counter
000000000002004 R greeting
000000000001149 T add
00000000000115f T main
                 U printf@@GLIBC_2.2.5
000000000004028 B uninitialized_slot
```

The single-letter codes explain where each symbol lives:

- **`T` / `t`**: Text section (executable function code).
- **`D` / `d`**: Data section (initialized variable).
- **`B` / `b`**: BSS section (uninitialized variable).
- **`R` / `r`**: Read-only data section (`greeting`).
- **`U`**: Undefined symbol! The binary does not contain `printf`. It will be resolved dynamically at runtime by the dynamic linker from `libc`.

### 5. `objdump -d`: Disassembling Machine Code

`objdump -d` transforms raw bytes in the `.text` section back into assembly instructions:

```bash
$ objdump -d -M intel --no-show-raw-insn demo
```

Looking at our `add` function:

```nasm
0000000000001149 <add>:
    push   rbp
    mov    rbp, rsp
    mov    DWORD PTR [rbp-0x4], edi    ; Store first parameter (a)
    mov    DWORD PTR [rbp-0x8], esi    ; Store second parameter (b)
    mov    edx, DWORD PTR [rbp-0x4]
    mov    eax, DWORD PTR [rbp-0x8]
    add    eax, edx                    ; Execute addition instruction
    pop    rbp
    ret                                ; Return result in EAX
```

We can trace directly how high-level C code compiled into standard x86_64 register operations (`edi`, `esi`, and `eax`).

---

## 4. Dynamic Linking: GOT and PLT

How does your binary call `printf()` if the code for `printf` is not inside your file?

Compiling every library statically would produce huge binaries and prevent operating systems from sharing library memory pages between processes. Modern systems use **Dynamic Linking** with lazy binding through the Procedure Linkage Table (PLT) and Global Offset Table (GOT):

1. **PLT (Procedure Linkage Table):** A small jump table in the executable. When `main()` calls `printf()`, it jumps to `printf@plt`.
2. **GOT (Global Offset Table):** An array of memory addresses located in the writable `.got.plt` section.
3. On the first call, the GOT entry points back to resolver code in the dynamic linker (`ld.so`). The linker looks up `printf` in `libc.so`, writes the true virtual memory address into the GOT, and executes the function.
4. On all subsequent calls, `printf@plt` jumps directly to the cached address in the GOT with zero resolution overhead.

---

## 5. Security Mitigations in Modern Binaries

When auditing compiled software, security engineers check for three crucial hardening flags:

1. **PIE (Position Independent Executable):** Allows the operating system to randomize the base memory address of code and data pages upon every execution (ASLR), neutralizing hardcoded buffer overflow exploits.
2. **NX / DEP (No-Execute / Data Execution Prevention):** Enforces **W^X (Write XOR Execute)**. Memory pages are either writable or executable, but never both. The stack and heap cannot execute instructions.
3. **Stack Canaries (Stack Smashing Protection):** A random guard value placed on the stack frame immediately before the return address. If a buffer overflow overwrites the return pointer, the canary value changes, and `__stack_chk_fail` terminates the process instantly.

Inspect binary protections using `checksec`:

```bash
$ checksec --file=demo
RELRO           STACK CANARY      NX            PIE             RPATH      RUNPATH
Full RELRO      Canary found      NX enabled    PIE enabled     No RPATH   No RUNPATH
```

---

## Summary

When you strip away the abstraction layers, executable files are meticulously organized records: headers tell the operating system kernel how to map memory pages; sections categorize instructions, constants, and global buffers; symbol tables link dependent modules; and the dynamic linker resolves library pointers at launch.

Mastering these binary inspection tools transforms systems debugging, vulnerability research, and performance tuning from guesswork into an exact science.
