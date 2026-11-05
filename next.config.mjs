/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  reactStrictMode: false,
  serverExternalPackages: ['pg','ws'],
  poweredByHeader: false,
  async redirects() {
    return [
      {source:'/player.html',destination:'/spelen',permanent:false},
      {source:'/spelen/klassiek',destination:'/spelen',permanent:false},
      ...['index.html','studio-hub.html','milo-studio.html'].map(path=>({source:'/'+path,destination:'/',permanent:false})),
    ];
  },
  async headers() {
    return [{source:'/:path*',headers:[
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'Referrer-Policy',value:'same-origin'},
      {key:'Permissions-Policy',value:'camera=(self), microphone=(self), geolocation=()'},
    ]}];
  },
};
export default config;
