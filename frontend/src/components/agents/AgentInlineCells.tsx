import { CrontabHelperLink } from "@/components/agents/CrontabHelperLink";
import { Input, Switch } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { getCrontabError } from "@/lib/crontab";
import { getTimeoutError } from "@/lib/timeout";

export function EnabledToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return <Switch checked={value} onCheckedChange={onChange} />;
}

export function InlineModelSelect({
  value,
  models,
  onChange,
}: {
  value: string;
  models: string[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="w-full min-w-[12rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {models.map((model) => (
        <option key={model} value={model}>
          {model}
        </option>
      ))}
    </select>
  );
}

export function InlineCrondInput({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  const error = getCrontabError(value);

  const tryCommit = () => {
    if (error) return;
    onCommit();
  };

  return (
    <div className="min-w-[10rem] space-y-1">
      <div className="flex items-center gap-1">
        <Input
          className={cn("min-w-[10rem]", error && "border-red-500 focus-visible:ring-red-500")}
          value={value}
          placeholder="0 9 * * *"
          aria-invalid={!!error}
          onChange={(e) => onChange(e.target.value)}
          onBlur={tryCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!error) tryCommit();
            }
          }}
        />
        <CrontabHelperLink />
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

export function InlineTimeoutInput({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  const error = getTimeoutError(value);

  const tryCommit = () => {
    if (error) return;
    onCommit();
  };

  return (
    <div className="min-w-[5rem] space-y-1">
      <Input
        className={cn("w-20 font-mono tabular-nums", error && "border-red-500 focus-visible:ring-red-500")}
        value={value}
        placeholder="5:00"
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value)}
        onBlur={tryCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (!error) tryCommit();
          }
        }}
      />
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
