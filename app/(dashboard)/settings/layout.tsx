export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col p-4 md:px-6 md:py-5">{children}</div>
  );
}
