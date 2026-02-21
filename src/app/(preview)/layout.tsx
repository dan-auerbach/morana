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
          backgroundColor: "var(--bg)",
          fontFamily: "'Georgia', 'Times New Roman', serif",
          color: "var(--white)",
        }}
      >
        {children}
      </body>
    </html>
  );
}
