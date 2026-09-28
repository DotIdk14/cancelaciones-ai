import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  typedRoutes: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '250mb',
    },
  },
  transpilePackages: [
    '@cancelaciones/shared',
    '@cancelaciones/db',
    '@cancelaciones/evidence',
    '@cancelaciones/ai',
  ],
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;
