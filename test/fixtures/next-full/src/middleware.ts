export function middleware(req: Request) {
  return req.headers.get('x-shop') ? undefined : new Response('no', { status: 403 });
}

export const config = { matcher: ['/api/:path*'] };
