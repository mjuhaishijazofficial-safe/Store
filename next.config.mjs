import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pins the project root explicitly — a stray package-lock.json one
  // level up (D:\Store, not part of this git repo) otherwise makes
  // Turbopack's workspace-root detection ambiguous and print a warning
  // on every build.
  turbopack: {
    root: __dirname
  },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' }
  }
};

export default nextConfig;
