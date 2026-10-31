import { createFileRoute } from "@tanstack/react-router";
import { CantinhoApp } from "@/components/cantinho/cantinho-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <CantinhoApp />;
}
