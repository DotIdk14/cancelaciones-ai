import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '250mb',
    },
  },
  transpilePackages: [
    '@cancelaciones/domain',
    '@cancelaciones/db',
    '@cancelaciones/reporting',
    '@cancelaciones/rule-engine-v2',
  ],
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;
