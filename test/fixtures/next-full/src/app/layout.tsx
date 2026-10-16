export default function RootLayout({ children, modal }: { children: any; modal: any }) {
  return <html><body>{children}{modal}</body></html>;
}
