---
'performance-kit': minor
---

Add a repeatable `run --chrome-arg` option for extra Chrome flags, such as enabling Vulkan for hardware WebGPU in headless Linux. The flags are recorded in `environment.chromeFlags`. The launch probe retries `requestAdapter()` briefly, because headless Chrome on Linux/Vulkan returns `null` for the first request; this also warms up WebGPU so workloads do not fall back to WebGL2.
