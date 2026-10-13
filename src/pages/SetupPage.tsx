import { PencilMark } from "../brand/PencilMark";
import { FullPageMessage } from "../components/ui/FullPageMessage";

/** Shown when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. */
export function SetupPage() {
  return (
    <FullPageMessage doodle={<PencilMark size={72} />} title="Almost there.">
      <div className="flex flex-col gap-3 text-left">
        <p>Uncle Draw needs a Supabase project to save your boards.</p>
        <ol className="flex list-decimal flex-col gap-1 pl-6">
          <li>
            Copy <code>.env.example</code> to <code>.env.local</code>.
          </li>
          <li>
            Fill in <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> from your
            project&apos;s API settings.
          </li>
          <li>Restart the dev server.</li>
        </ol>
        <p>The README has the full setup, including migrations and auth providers.</p>
      </div>
    </FullPageMessage>
  );
}
