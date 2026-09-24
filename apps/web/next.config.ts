import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '250mb',
    },
  },
  transpilePackages: ['@cancelaciones/domain', '@cancelaciones/db', '@cancelaciones/policy-engine', '@cancelaciones/reporting'],
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;
