export default function PreviewRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="sl">
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: "#0a0a0a",
          fontFamily: "'Georgia', 'Times New Roman', serif",
          color: "#e0e0e0",
        }}
      >
        {children}
      </body>
    </html>
  );
}
