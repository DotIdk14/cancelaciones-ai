import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: true,
  transpilePackages: ['@cancelaciones/domain', '@cancelaciones/db', '@cancelaciones/policy-engine', '@cancelaciones/reporting'],
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;
