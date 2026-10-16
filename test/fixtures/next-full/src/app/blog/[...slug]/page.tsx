import { format } from '@/lib/dates';

export default function BlogPage() {
  return <article>{format(new Date(0))}</article>;
}
