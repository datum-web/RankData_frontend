/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The dataset lives outside the app; sync-dataset.mjs copies it into public/.
  eslint: { ignoreDuringBuilds: true },
};
