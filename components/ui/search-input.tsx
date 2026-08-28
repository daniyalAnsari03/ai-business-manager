"use client";

import { SearchIcon, XIcon } from "@/components/ui/icons";

type SearchInputProps = {
  label: string;
  placeholder: string;
  clearLabel: string;
  value: string;
  onChange: (value: string) => void;
  /** Optional live result count shown while searching. */
  resultText?: string;
};

/** Rounded search field with clear affordance, shared by module views. */
export function SearchInput({
  label,
  placeholder,
  clearLabel,
  value,
  onChange,
  resultText,
}: SearchInputProps) {
  const isSearching = value.trim().length > 0;

  return (
    <div className="max-w-md">
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-faint"
        />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
          className="min-h-12 w-full rounded-full border border-line bg-surface pl-11 pr-11 text-[15px] text-foreground shadow-card transition-colors duration-200 placeholder:text-faint hover:border-emerald-500/30 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 [&::-webkit-search-cancel-button]:hidden"
        />
        {isSearching ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={clearLabel}
            className="absolute right-1.5 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        ) : null}
      </div>
      {isSearching && resultText ? (
        <p className="mt-2 px-1 text-xs text-faint" role="status">
          {resultText}
        </p>
      ) : null}
    </div>
  );
}
