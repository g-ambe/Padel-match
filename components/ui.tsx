import { ReactNode } from "react";

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-2xl bg-card p-4 shadow-lg"><h2 className="mb-3 text-lg font-bold">{title}</h2>{children}</section>;
}

export function ActionButton({ children, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`w-full rounded-2xl bg-accent py-3 font-semibold text-black ${className}`} {...props}>{children}</button>;
}
