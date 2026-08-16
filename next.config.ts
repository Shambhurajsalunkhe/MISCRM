import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Document uploads go through a server action, whose request body
      // defaults to a 1 MB cap. `MAX_UPLOAD_BYTES` in src/lib/storage.ts allows
      // 10 MB, so without this every proposal, contract scan or resume over
      // 1 MB was rejected by the framework before the action ran — the friendly
      // "that file is too large" message was unreachable. The headroom covers
      // the multipart encoding around the file itself.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
