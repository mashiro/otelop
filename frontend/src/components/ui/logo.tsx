export function Logo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className={className} aria-hidden>
      <circle cx="32" cy="22" r="14" fill="#18b4c2" fillOpacity="0.85" />
      <circle cx="22.9" cy="37.8" r="14" fill="#a85dd4" fillOpacity="0.85" />
      <circle cx="41.1" cy="37.8" r="14" fill="#caa03a" fillOpacity="0.85" />
    </svg>
  );
}
