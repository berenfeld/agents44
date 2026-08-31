import { createContext, useContext } from "react";

export type DesktopNotificationPermission = NotificationPermission | "unsupported";

export type DesktopNotificationsContextValue = {
  supported: boolean;
  permission: DesktopNotificationPermission;
  preferenceOn: boolean;
  enabled: boolean;
  busy: boolean;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};

export const DesktopNotificationsContext = createContext<DesktopNotificationsContextValue>({
  supported: false,
  permission: "unsupported",
  preferenceOn: false,
  enabled: false,
  busy: false,
  enable: async () => {},
  disable: async () => {},
});

export function useDesktopNotifications() {
  return useContext(DesktopNotificationsContext);
}
