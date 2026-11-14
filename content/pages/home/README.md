# Hi, I'm Rishav

JavaScript & Full-Stack Developer &bull; Systems & Web Internals

## Summary

JavaScript and full-stack developer with a deep curiosity for how things actually work under the hood — from browser rendering engines and hydration boundaries to TCP packet delivery, V8 memory allocation, and distributed backend architectures. Experienced in building production monoliths with end-to-end typed RPC contracts, high-throughput financial and attribution pipelines, and token-efficient developer tooling.

---

## Specialties

- **Frameworks & Modern Web Rendering:** Deep mental model of how web frameworks operate and how pages are rendered. Comfortable across shallow routing, client-side SPAs, static site generation (SSG), hydration mechanics, React Server Components boundaries, and streaming in between.
- **Networking & Data Transfer:** Practical, deep knowledge of network request mechanics: TCP handshakes, sliding windows, chunked data streaming (`Transfer-Encoding: chunked`), round-trip latency minimization (RTT), checksum verification, and resilient caching hierarchies.
- **Modern CSS & Technical SEO:** Zero-dependency modern CSS, CSS grid/flexbox layouts, responsive design, Pico CSS, Core Web Vitals optimization, semantic HTML, and crawlable metadata architecture for clean indexing.
- **Compilers, V8 & Memory Management:** Understanding how source code compiles down to bytecode and native machine code; V8 internals (Hidden Classes, Shapes, Inline Caching), Garbage Collection algorithms (Cheney scavenging, Mark-Sweep-Compact, Orinoco concurrent marking), and memory leak detection.
- **Theory & Foundations:** A dabbler in lambda calculus (total noob, but deriving Church encodings and the Y Combinator for fun).

---

## Projects

### Personal

- **[rin](https://github.com/Rishav-Redapple/rin)** — _Reduced Interface Notation_  
  A compact schema notation language with a hand-written TypeScript parser, runtime validator, and CLI. Cuts schema size and token counts by ~40% for LLM context windows while maintaining strict precision. Also supports JSON-to-Go struct generation.
- **[http.fish](https://github.com/Rishav-Redapple/http.fish)** — _Fish Shell HTTP Client_  
  A compact, ergonomic HTTP client for Fish shell built on top of `curl`. Features request context caching, JSON body parsing with jq/perl fallbacks, artifact dumping, dry-run curl previewing, and native completions.
- **[flag.ts](https://github.com/Rishav-Redapple/flag.ts)** — _Minimalist Typed CLI Parser_  
  A single-file, zero-dependency CLI argument parser inspired by Go's `flag` package and Tsoding's `flag.h`. Strongly typed, explicit, and uses an unconventional `/name:value` syntax with reactive `FlagRef<T>` pointers.

### Work & Production

- **Full-Stack Monolith (Admin + Web + Backend):** End-to-end monolithic web platform and admin panel. Backed by **Hono RPC** for fully type-safe API communication between frontend consumers, mobile clients, and backend services.
- **Distributed Database Architecture:** High-throughput transactional data layer with structured read/write separation, caching tiers, and data integrity guarantees for high-traffic environments.
- **Influencer & Creator Dashboard:** Production attribution and monetization system: client/server campaign tracking, write-time frozen revenue accounting, slab-based payouts with KYC verification, public/private campaign approval workflows, and automated tier-progression logic.

---

## Skills

JavaScript · TypeScript · Bun · Node.js · Next.js · Hono (RPC) · React · REST & RPC API Design · TCP / HTTP Internals · V8 Runtime & GC · Modern CSS · PostgreSQL · MongoDB · Fish Shell
