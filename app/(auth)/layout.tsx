export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-[var(--color-bg)] p-(--space-8)">
      <div className="w-full">
        {children}
      </div>
    </div>
  )
}
