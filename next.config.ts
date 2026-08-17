import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` and `next build` both write to `.next` by default, and a build run
  // while a dev server is up replaces the manifests that server is holding open —
  // after which every page fails with "Expected clientReferenceManifest to be
  // defined" until the dev server is restarted. Nothing in the app is wrong at
  // that point, which is what makes it an expensive hour.
  //
  // So a build can be sent somewhere else while one is running:
  //
  //   bash:       NEXT_DIST_DIR=.next-build npx next build
  //   PowerShell: $env:NEXT_DIST_DIR='.next-build'; npx next build
  //
  // The default stays `.next`, so deployments and `next start` behave exactly as
  // they did — this is an escape hatch for building on a machine that is also
  // serving the app, not a change to where the app ships from.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Both are Node libraries the report exports load dynamically: ExcelJS writes
  // the workbook and React PDF renders the document. Bundling them would rewrite
  // their `require`s and their font and zip internals, which is how a PDF route
  // that works in `next dev` fails only in a production build.
  serverExternalPackages: ["exceljs", "@react-pdf/renderer"],
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
