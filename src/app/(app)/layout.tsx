import { BottomTabs } from "@/components/bottom-tabs";
import { CommandPalette } from "@/components/command-palette";
import { MobileHeader } from "@/components/mobile-header";
import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground focus:translate-y-0"
      >
        Skip to content
      </a>
      <Sidebar name={session.user.name} email={session.user.email} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main
          id="main"
          tabIndex={-1}
          className="flex-1 scroll-mt-14 px-4 pb-28 pt-6 focus:outline-none md:scroll-mt-0 md:px-10 md:pb-10 md:pt-10"
        >
          {children}
        </main>
      </div>
      <BottomTabs />
      <CommandPalette />
    </div>
  );
}
