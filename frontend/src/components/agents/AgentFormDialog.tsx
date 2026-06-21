import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Agent, api, AgentWritePayload, buildAgentWritePayload, Department, ModelsResponse } from "@/api/client";
import { CrontabHelperLink } from "@/components/agents/CrontabHelperLink";
import { Modal } from "@/components/ui/modal";
import { Button, Input, Label, Switch } from "@/components/ui/primitives";
import { getCrontabError } from "@/lib/crontab";
import { getTimeoutError, formatTimeoutSeconds, parseTimeoutInput } from "@/lib/timeout";
import { cn } from "@/lib/utils";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  department: z.string().min(1, "Department is required"),
  model: z.string().min(1, "Model is required"),
  crond: z
    .string()
    .optional()
    .nullable()
    .refine((value) => getCrontabError(value ?? "") === null, (value) => ({
      message: getCrontabError(value ?? "") ?? "Invalid cron expression",
    })),
  enabled: z.boolean(),
  timeout: z
    .string()
    .min(1, "Timeout is required")
    .refine((value) => getTimeoutError(value) === null, (value) => ({
      message: getTimeoutError(value) ?? "Invalid timeout",
    })),
});

type FormValues = z.infer<typeof schema>;

function FormField({
  label,
  htmlFor,
  labelExtra,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  labelExtra?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-x-3 gap-y-1",
        className,
      )}
    >
      <div className="flex items-center justify-end gap-1.5">
        <Label htmlFor={htmlFor} className="mb-0 text-right">
          {label}
        </Label>
        {labelExtra}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function AgentFormDialog({
  open,
  onOpenChange,
  agent,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent?: Agent;
  onSubmit: (values: AgentWritePayload) => Promise<void>;
}) {
  const [models, setModels] = useState<ModelsResponse>({ models: [], default: "" });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [created, setCreated] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      name: "",
      department: "",
      model: "",
      crond: "",
      enabled: true,
      timeout: "5:00",
    },
  });

  useEffect(() => {
    if (!open) {
      setCreated(false);
      return;
    }

    let cancelled = false;
    Promise.all([api.get<ModelsResponse>("/models"), api.get<Department[]>("/departments")]).then(
      ([modelsRes, departmentsRes]) => {
        if (cancelled) return;
        setModels(modelsRes.data);
        setDepartments(departmentsRes.data);
        reset({
          name: agent?.name || "",
          department: agent?.department || departmentsRes.data[0]?.name || "",
          model: agent?.model || modelsRes.data.default,
          crond: agent?.crond || "",
          enabled: agent?.enabled ?? true,
          timeout: agent ? formatTimeoutSeconds(agent.timeout_seconds) : "5:00",
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [open, agent, reset]);

  const enabled = watch("enabled");

  const submitLabel = agent
    ? isSubmitting
      ? "Saving..."
      : "Save"
    : created
      ? "Created"
      : isSubmitting
        ? "Creating..."
        : "Create";

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={agent ? "Edit Agent" : "New Agent"}>
      <form
        className="space-y-2.5"
        onSubmit={handleSubmit(async (values) => {
          const timeoutSeconds = parseTimeoutInput(values.timeout);
          if (timeoutSeconds === null) return;
          setCreated(false);
          await onSubmit(
            buildAgentWritePayload({
              name: values.name,
              department: values.department,
              model: values.model,
              crond: values.crond || null,
              enabled: values.enabled,
              timeout_seconds: timeoutSeconds,
            }),
          );
          if (!agent) {
            setCreated(true);
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          onOpenChange(false);
        })}
      >
        <FormField label="Name" htmlFor="name">
          <Input id="name" {...register("name")} disabled={!!agent} />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </FormField>
        <FormField label="Department" htmlFor="department">
          <select
            id="department"
            className="w-full rounded-md border px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500"
            {...register("department")}
            disabled={!!agent || departments.length === 0}
          >
            {departments.length === 0 ? (
              <option value="">Create a department first</option>
            ) : (
              departments.map((department) => (
                <option key={department.id} value={department.name}>
                  {department.name}
                </option>
              ))
            )}
          </select>
          {errors.department && <p className="text-sm text-red-600">{errors.department.message}</p>}
        </FormField>
        <FormField label="Model" htmlFor="model">
          <select id="model" className="w-full rounded-md border px-3 py-2 text-sm" {...register("model")}>
            {models.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          {errors.model && <p className="text-sm text-red-600">{errors.model.message}</p>}
        </FormField>
        <FormField label="Cron schedule" htmlFor="crond" labelExtra={<CrontabHelperLink />}>
          <Input id="crond" placeholder="0 9 * * *" {...register("crond")} />
          {errors.crond && <p className="text-sm text-red-600">{errors.crond.message}</p>}
        </FormField>
        <FormField label="Timeout (mm:ss)" htmlFor="timeout">
          <Input id="timeout" placeholder="5:00" className="font-mono" {...register("timeout")} />
          {errors.timeout && <p className="text-sm text-red-600">{errors.timeout.message}</p>}
        </FormField>
        <div className="grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-x-3">
          <Label className="mb-0 text-right">Enabled</Label>
          <div className="flex justify-end">
            <Switch checked={enabled} onCheckedChange={(value) => setValue("enabled", value, { shouldValidate: true })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting || (!agent && departments.length === 0)}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
