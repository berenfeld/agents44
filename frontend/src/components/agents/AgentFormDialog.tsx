import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Agent, api, Department, ModelsResponse } from "@/api/client";
import { CrontabHelperLink } from "@/components/agents/CrontabHelperLink";
import { Modal } from "@/components/ui/modal";
import { Button, Input, Label, Switch } from "@/components/ui/primitives";
import { getCrontabError } from "@/lib/crontab";
import { getTimeoutError, formatTimeoutSeconds, parseTimeoutInput } from "@/lib/timeout";

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
type AgentSubmitValues = Omit<FormValues, "timeout" | "crond"> & {
  crond: string | null;
  timeout_seconds: number;
};

export function AgentFormDialog({
  open,
  onOpenChange,
  agent,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent?: Agent;
  onSubmit: (values: AgentSubmitValues) => Promise<void>;
}) {
  const [models, setModels] = useState<ModelsResponse>({ models: [], default: "" });
  const [departments, setDepartments] = useState<Department[]>([]);
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
    if (!open) return;

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

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={agent ? "Edit Agent" : "New Agent"}>
      <form
        className="space-y-4"
        onSubmit={handleSubmit(async (values) => {
          const { timeout, ...rest } = values;
          const timeoutSeconds = parseTimeoutInput(timeout);
          if (timeoutSeconds === null) return;
          await onSubmit({ ...rest, crond: values.crond || null, timeout_seconds: timeoutSeconds });
          onOpenChange(false);
        })}
      >
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" {...register("name")} disabled={!!agent} />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>
        <div>
          <Label htmlFor="department">Department</Label>
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
        </div>
        <div>
          <Label htmlFor="model">Model</Label>
          <select id="model" className="w-full rounded-md border px-3 py-2 text-sm" {...register("model")}>
            {models.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          {errors.model && <p className="text-sm text-red-600">{errors.model.message}</p>}
        </div>
        <div>
          <div className="mb-1 flex items-center gap-1.5">
            <Label htmlFor="crond">Cron schedule</Label>
            <CrontabHelperLink />
          </div>
          <Input id="crond" placeholder="0 9 * * *" {...register("crond")} />
          {errors.crond && <p className="text-sm text-red-600">{errors.crond.message}</p>}
        </div>
        <div>
          <Label htmlFor="timeout" className="mb-1 block">
            Timeout (mm:ss)
          </Label>
          <Input id="timeout" placeholder="5:00" className="font-mono" {...register("timeout")} />
          {errors.timeout && <p className="text-sm text-red-600">{errors.timeout.message}</p>}
        </div>
        <div className="flex items-center justify-between">
          <Label>Enabled</Label>
          <Switch checked={enabled} onCheckedChange={(value) => setValue("enabled", value, { shouldValidate: true })} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting || (!agent && departments.length === 0)}>
            {agent ? "Save" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
