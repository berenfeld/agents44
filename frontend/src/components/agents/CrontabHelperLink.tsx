import { CRONTAB_HELPER_URL } from "@/lib/crontab";

export function CrontabHelperLink() {
  return (
    <a
      href={CRONTAB_HELPER_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Open crontab.guru"
      aria-label="Open crontab.guru"
      className="inline-flex shrink-0 text-slate-500 hover:text-slate-800"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </a>
  );
}
