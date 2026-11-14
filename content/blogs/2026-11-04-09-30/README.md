# Inside the V8 Engine: How JavaScript Garbage Collection Actually Works

In high-level languages like JavaScript, memory management is often described as "automatic." You instantiate an object, push elements into an array, or concatenate strings, and the runtime engine transparently allocates system memory. When those values are no longer needed, the Garbage Collector (GC) silently reclaims that memory.

However, treating garbage collection as a magical black box is a dangerous habit. In long-running Node.js services, high-frequency real-time web applications, and heavy frontend dashboards, poor memory hygiene leads to latency spikes, frequent "stop-the-world" freezes, and catastrophic out-of-memory crashes (`ERR_WORKER_OUT_OF_MEMORY`).

To write performant JavaScript, you must understand the mechanical reality under the hood: how the V8 engine (which powers Google Chrome, Node.js, Bun, and Deno) manages memory and executes garbage collection.

---

## 1. The V8 Memory Layout

When V8 executes your program, memory is divided into the **Stack** and the **Heap**:

- **Stack:** Stores primitive values (numbers, booleans, small strings) and pointers referencing objects on the heap. Stack frames are managed via standard CPU call-stack mechanics (O(1) push/pop).
- **Heap:** A contiguous segment of virtual memory dedicated to reference types (objects, arrays, closures, compiled functions, and dynamic strings).

The V8 Heap is segregated into dedicated functional spaces:

1. **New Space (Young Generation):** Where virtually all newly instantiated objects begin their lifecycle. It is small (typically between 1MB and 64MB) and designed for ultra-fast allocations and collections.
2. **Old Space (Old Generation):** Contains long-lived objects that survived multiple minor GC cycles. Old Space is divided into:
   - _Old Pointer Space:_ Objects containing references to other objects.
   - _Old Data Space:_ Objects containing raw data (strings, boxed numbers, byte buffers).
3. **Large Object Space:** Objects exceeding allocation size limits (e.g., massive arrays or buffers) are placed directly here. They are never moved by scavengers to avoid heavy memory-copy overhead.
4. **Code Space:** Where the TurboFan compiler places optimized native machine instructions.
5. **Map / Cell Space:** Stores hidden classes (Shapes) that track the structure of dynamic objects for fast property lookups.

---

## 2. The Generational Hypothesis

V8’s memory architecture is fundamentally anchored on the **Weak Generational Hypothesis**:

> _"Most objects die young."_

In software development, the overwhelming majority of allocated objects are short-lived: local variables inside loop iterations, function arguments, intermediate promises, and temporary formatting strings. These objects become unreachable milliseconds after instantiation.

By dividing the heap into Young and Old generations, V8 avoids scanning millions of long-lived objects every time memory needs reclaiming. Instead, it frequently runs an ultra-fast **Minor GC** over the small Young generation, and only periodically runs a thorough **Major GC** over the entire Old generation.

---

## 3. Minor GC: The Scavenger (Cheney’s Copying Algorithm)

The Young generation is split into two equal semi-spaces: **From-Space** (where active allocations happen) and **To-Space** (used as a clean compaction target during collections).

### Allocation Pointer Bump

Allocating an object in From-Space requires zero search time. V8 maintains an `allocation_top` pointer. When you declare `const item = {}`, V8 simply bumps the pointer forward by the object's byte size. It is as fast as a C stack allocation.

### The Scavenge Step

When From-Space becomes full, V8 triggers a **Scavenger** pass:

1. The collector traverses roots (pointers on the active execution stack and global objects) to find all live objects in From-Space.
2. Live objects are copied sequentially into To-Space. Because they are copied contiguously into the start of To-Space, memory fragmentation is completely eliminated without a separate compaction phase.
3. Dead objects (unreferenced) are simply ignored.
4. Once copying finishes, the roles are reversed: From-Space becomes To-Space, and To-Space becomes From-Space.

### Object Promotion (Aging)

Objects that survive one scavenge pass are marked as intermediate. If an object survives a **second** scavenge pass, V8 promotes it out of the Young generation into the **Old Space**.

---

## 4. Major GC: Mark-Sweep-Compact

When the Old Space reaches dynamic memory thresholds, V8 runs a Major GC. Major GC uses the classic **Mark-Sweep-Compact** algorithm.

### Phase 1: Tri-Color Marking

V8 marks the reachability of every object using three states:

- **White:** Unvisited object. At the start, all objects are white. Any object that remains white at the end of marking is garbage.
- **Grey:** The object has been discovered and visited, but its referenced children have not been evaluated yet.
- **Black:** The object has been visited, and all objects it points to have been discovered and pushed onto the grey marking stack.

1. V8 identifies the root pointers (execution stack frames, global scope, browser DOM handles).
2. Root objects are pushed onto the grey stack.
3. The collector pops an object from the grey stack, marks all objects it references as grey, and marks the parent object black.
4. The process repeats until the grey stack is completely empty.

### Phase 2: Sweeping

V8 iterates through the memory pages of Old Space. It identifies contiguous blocks occupied by white (dead) objects and adds their addresses to **Free Lists**. Free lists are organized by size categories so future allocations can quickly find available slots.

### Phase 3: Compacting

Over time, Old Space suffers from memory fragmentation: small live objects surrounded by free blocks, preventing large contiguous allocations. During compaction, V8 slides live objects toward the beginning of the page, updating all memory pointers that reference them.

---

## 5. Orinoco: Eliminating the "Stop-The-World" Pause

Historically, garbage collection required a **Stop-The-World (STW)** pause: the JavaScript main execution thread was completely suspended while the collector traversed the heap. For games or interactive UIs running at 60 FPS (16.6ms per frame budget), a 100ms GC pause caused severe frame drops and jank.

Under project **Orinoco**, V8 transitioned GC from a single-threaded blocking model into a modern concurrent and parallel architecture:

1. **Parallel Marking and Sweeping:** The main thread coordinates with multiple background worker threads. When an operation runs, threads divide memory pages concurrently.
2. **Incremental Marking:** Rather than marking the entire heap in one monolithic 150ms pause, V8 breaks marking down into micro-slices of 5ms–10ms, interleaved between normal JavaScript execution loops.
3. **Concurrent Marking:** Background threads perform tri-color marking concurrently while user JavaScript is actively mutating the heap. V8 uses write barriers to detect whenever running code alters an existing pointer relationship.
4. **Idle-Time GC:** V8 integrates with the event loop. When Chrome or Node.js detects an idle frame (e.g., waiting for network I/O or before the next vsync signal), it schedules small GC tasks during those spare milliseconds.

---

## 6. Common JavaScript Memory Leaks and How to Fix Them

Even with state-of-the-art garbage collectors, unreachable memory is only collected if your code ceases referencing it. If an unused object remains connected to a root, V8 cannot legally free it.

### 1. Accidental Closure Retention

Closures retain their surrounding lexical environment. If an inner function captures an outer scope, everything in that scope remains alive:

```typescript
// ❌ LEAK PATTERN: The interval holds outerLargeData in memory indefinitely
function startService() {
  const outerLargeData = new Uint8Array(50 * 1024 * 1024) // 50MB buffer

  return function logStatus() {
    console.log('Service active')
    // Even though outerLargeData is never referenced here,
    // some engines retain the whole lexical scope record!
  }
}

const reporter = startService()
setInterval(reporter, 1000)
```

**Fix:** Explicitly decouple large temporary buffers from long-lived closures or nullify references once consumed:

```typescript
// ✅ FIX: Clean scope boundaries
function startServiceClean() {
  {
    const outerLargeData = new Uint8Array(50 * 1024 * 1024)
    processBuffer(outerLargeData)
  } // outerLargeData falls out of block scope here

  return function logStatus() {
    console.log('Service active')
  }
}
```

### 2. Unbounded Caches and the Power of `WeakMap`

Using standard `Map` or `Set` collections for caching prevents keys and values from ever being garbage-collected, because the collection holds strong references.

```typescript
// ❌ LEAK: Every cached session stays alive forever
const userCache = new Map<HTMLElement, UserData>()

function trackUserElement(element: HTMLElement, data: UserData) {
  userCache.set(element, data)
}
// When element is removed from DOM, userCache still retains it!
```

**Fix:** Use `WeakMap`. References held by a `WeakMap` are weak: if no other strong reference to the object exists, the garbage collector will reclaim both the key and the value automatically:

```typescript
// ✅ FIX: WeakMap allows garbage collection when DOM element is unmounted
const userCache = new WeakMap<HTMLElement, UserData>()

function trackUserElementSafe(element: HTMLElement, data: UserData) {
  userCache.set(element, data)
}
```

### 3. Lingering Event Listeners and Timers

Always remove event listeners and clear intervals in component unmount lifecycles or service teardown hooks:

```typescript
// Clean teardown pattern
class WebSocketMonitor {
  private timer: NodeJS.Timeout | null = null

  public connect() {
    this.timer = setInterval(() => this.heartbeat(), 5000)
  }

  public destroy() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
```

---

## 7. Diagnosing Leaks with Chrome DevTools Heap Snapshots

When investigating a memory leak in Node.js or Chrome:

1. Open **Chrome DevTools** -> **Memory** tab.
2. Take a **Heap Snapshot** at baseline.
3. Perform the suspected user action (e.g., opening and closing a modal 10 times).
4. Take a second **Heap Snapshot**.
5. Switch the view from **Summary** to **Comparison**, and sort by **Size Delta**.
6. Inspect the **Retainers** tree at the bottom to identify the root pointer preventing V8 from collecting the orphaned instances.

Understanding the balance between the Young generation scavenger and Old generation mark-sweep empowers you to architect JavaScript systems that run smoothly, predictably, and with near-zero latency overhead.
