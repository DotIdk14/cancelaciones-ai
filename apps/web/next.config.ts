import type { NextConfig } from 'next';

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
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;
