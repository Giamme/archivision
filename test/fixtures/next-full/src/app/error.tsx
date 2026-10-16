'use client';

export default function ErrorBoundary({ error }: { error: Error }) {
  return <p>{error.message}</p>;
}
