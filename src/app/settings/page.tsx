import { TOOLS, AUTOFIX_TOOLS } from "@/lib/excel/transform";
import { SettingsView } from "@/components/settings-view";

export default function SettingsPage() {
  const rules = TOOLS.map((t) => ({
    id: t.id,
    group: t.group,
    name: t.name,
    description: t.desc,
    safeDefault: t.safeDefault,
    autoFix: t.autoFix,
    targets: t.targets,
  }));

  return <SettingsView initialRules={rules} initialAutofix={[...AUTOFIX_TOOLS]} />;
}
