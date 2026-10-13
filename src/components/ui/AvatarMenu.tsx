import { IconInfoCircle, IconLogout, IconPencil } from "@tabler/icons-react";
import { useState } from "react";
import { useTheme, type ThemeSetting } from "../../app/theme";
import { useProfile } from "../../features/auth/profile";
import { useSignOut } from "../../features/auth/useSignOut";
import { Avatar, SketchMenu, type MenuEntry } from "../sketch";
import { AboutDialog } from "./AboutDialog";
import { EditNameDialog } from "./EditNameDialog";

const THEMES: Array<{ value: ThemeSetting; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** Avatar menu: name, Theme, About, Sign out (AUTH-3, AUTH-5, SET-1). */
export function AvatarMenu({ size = 32 }: { size?: number }) {
  const profile = useProfile();
  const { setting, setTheme } = useTheme();
  const signOut = useSignOut();
  const [editing, setEditing] = useState(false);
  const [about, setAbout] = useState(false);

  if (!profile) return null;

  const items: MenuEntry[] = [
    { type: "label", label: profile.displayName, key: "name" },
    {
      label: "Edit display name…",
      icon: <IconPencil size={16} stroke={1.75} />,
      onSelect: () => setEditing(true),
      key: "edit",
    },
    { type: "separator", key: "s1" },
    { type: "label", label: "Theme", key: "theme" },
    ...THEMES.map<MenuEntry>((t) => ({
      label: t.label,
      checked: setting === t.value,
      onSelect: () => setTheme(t.value),
      key: `theme-${t.value}`,
    })),
    { type: "separator", key: "s2" },
    {
      label: "About Uncle Draw",
      icon: <IconInfoCircle size={16} stroke={1.75} />,
      onSelect: () => setAbout(true),
      key: "about",
    },
    {
      label: "Sign out",
      icon: <IconLogout size={16} stroke={1.75} />,
      onSelect: () => void signOut(),
      key: "signout",
    },
  ];

  return (
    <>
      <SketchMenu
        label="Account"
        items={items}
        align="end"
        seedKey={`avatar-menu:${profile.id}`}
        trigger={(props) => (
          <button
            {...props}
            type="button"
            className="ud-iconbtn ud-sketch"
            aria-label={`Account menu for ${profile.displayName}`}
            title={profile.displayName}
          >
            <Avatar name={profile.displayName} url={profile.avatarUrl} size={size} seedKey={profile.id} />
          </button>
        )}
      />
      <EditNameDialog open={editing} onClose={() => setEditing(false)} currentName={profile.displayName} />
      <AboutDialog open={about} onClose={() => setAbout(false)} />
    </>
  );
}
