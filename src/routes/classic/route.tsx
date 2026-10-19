import { createFileRoute, Outlet } from "@tanstack/react-router";

import { RemoteHostProvider } from "@/classic/remote/host";

// Classic (edit left / live right) studio: its PeerJS phone remote + guest pairing
// are scoped to /classic/*, so the main Studio's own room system is untouched.
export const Route = createFileRoute("/classic")({
  component: ClassicLayout,
});

function ClassicLayout() {
  return (
    <RemoteHostProvider>
      <Outlet />
    </RemoteHostProvider>
  );
}
