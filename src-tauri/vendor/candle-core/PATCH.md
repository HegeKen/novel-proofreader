# candle-core 0.11.1 (patched)

This is an unmodified copy of the `candle-core` 0.11.1 crate except for one
change in `src/quantized/repack_x86.rs`:

```rust
// upstream: missing unsafe block, fails to compile on every x86_64 target
let info = unsafe { core::arch::x86_64::__cpuid_count(7, 0) };
```

Upstream `candle-core` 0.11.1 does not compile for x86_64 targets
(Windows x64, Android x86_64, macOS Intel) because `__cpuid_count` is called
outside an `unsafe` block (`error[E0133]`). This patch only wraps that call.

Remove this vendored crate and the `[patch.crates-io]` entry in
`src-tauri/Cargo.toml` once a fixed `candle-core` release is available.

License: MIT OR Apache-2.0 (see `LICENSE`).
