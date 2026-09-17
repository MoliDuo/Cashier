"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useUnsavedChangesStore } from "@/lib/store/unsaved-changes";
import { updateMyProfileAction } from "@/modules/auth/server-actions/update-my-profile";
import { useCoupleMembers } from "@/modules/auth/hooks/useCoupleMembers";
import { SettingsField } from "./SettingsField";
import { SettingsSection } from "./SettingsSection";
import { SettingsSectionActions } from "./SettingsSectionActions";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MemberGender, MemberProfileContract } from "@/application/contracts";

/**
 * The zones the picker offers — a short list rather than every IANA name:
 * there are two people, and 自动 already covers "wherever this device is".
 */
const TIME_ZONES = [
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
] as const;

interface ProfileDraft {
  nickname: string;
  gender: MemberGender;
  timeZone: string | null;
}

type ProfileField = keyof ProfileDraft;
const profileFields: readonly ProfileField[] = ["nickname", "gender", "timeZone"];

function toDraft(profile: MemberProfileContract): ProfileDraft {
  return { nickname: profile.nickname, gender: profile.gender, timeZone: profile.timeZone };
}

function draftsEqual(left: ProfileDraft, right: ProfileDraft): boolean {
  return (
    left.nickname === right.nickname &&
    left.gender === right.gender &&
    left.timeZone === right.timeZone
  );
}

interface ProfileSettingsProps {
  ledgerId: string;
  userId?: string;
  initialMembers: readonly MemberProfileContract[];
}

/**
 * Who is who: your nickname, your gender, and the zone your own dates and
 * statistics are read in. The partner's nickname is shown read-only, so it is
 * clear which side of the switch is which.
 */
export function ProfileSettings({ ledgerId, userId, initialMembers }: ProfileSettingsProps) {
  const t = useTranslations("Settings");
  const queryClient = useQueryClient();
  const { me, partner } = useCoupleMembers({
    ledgerId,
    userId: userId ?? "",
    initialMembers,
  });
  const [deviceTimeZone, setDeviceTimeZone] = useState<string | null>(null);
  const [server, setServer] = useState<ProfileDraft | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [touchedFields, setTouchedFields] = useState<Set<ProfileField>>(new Set());
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [serverChanged, setServerChanged] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setDeviceTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
      } catch {
        setDeviceTimeZone(null);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // The draft follows the query, so a save from another tab or device lands
  // here without a reload. Fields the reader has edited are kept instead.
  const incoming = me == null ? null : toDraft(me);
  if (incoming != null && !serverChanged && (server == null || !draftsEqual(server, incoming))) {
    const touchedServerFieldsChanged = profileFields.some(
      (field) => touchedFields.has(field) && server != null && server[field] !== incoming[field]
    );
    setServer(incoming);
    setDraft((current) =>
      current == null
        ? incoming
        : {
            nickname: touchedFields.has("nickname") ? current.nickname : incoming.nickname,
            gender: touchedFields.has("gender") ? current.gender : incoming.gender,
            timeZone: touchedFields.has("timeZone") ? current.timeZone : incoming.timeZone,
          }
    );
    setServerChanged((current) => current || touchedServerFieldsChanged);
  }
  const dirty = server != null && draft != null && !draftsEqual(server, draft);

  useEffect(() => {
    const key = "settings:profile";
    useUnsavedChangesStore.getState().setDirty(key, dirty);
    return () => useUnsavedChangesStore.getState().setDirty(key, false);
  }, [dirty]);

  const updateDraft = (patch: Partial<ProfileDraft>) => {
    setDraft((current) => (current == null ? current : { ...current, ...patch }));
    setTouchedFields((current) => {
      const next = new Set(current);
      for (const field of profileFields) {
        if (field in patch) next.add(field);
      }
      return next;
    });
    setError(null);
  };

  const handleSave = async () => {
    if (!dirty || draft == null || status === "saving") return;
    setStatus("saving");
    setError(null);
    try {
      const saved = await updateMyProfileAction({
        nickname: draft.nickname,
        gender: draft.gender,
        timeZone: draft.timeZone,
      });
      const savedDraft = toDraft(saved);
      setServer(savedDraft);
      setDraft(savedDraft);
      setTouchedFields(new Set());
      setServerChanged(false);
      setStatus("idle");
      // Written into the cache as well as invalidated: the member switch reads
      // this query, and it must not show the old nickname while the refetch is
      // in flight.
      queryClient.setQueryData<readonly MemberProfileContract[]>(
        queryKeys.coupleMembers(ledgerId),
        (current) => current?.map((member) => (member.id === saved.id ? saved : member)) ?? [saved]
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.coupleMembers(ledgerId) });
    } catch {
      setStatus("error");
      setError(t("profileSaveFailed"));
    }
  };

  const handleCancel = () => {
    if (server != null) setDraft(server);
    setTouchedFields(new Set());
    setServerChanged(false);
    setStatus("idle");
    setError(null);
  };

  if (me == null || draft == null) return null;

  return (
    <SettingsSection title={t("profile")} description={t("profileDesc")}>
      <SettingsField title={t("nickname")} description={t("nicknameDesc")}>
        <Input
          value={draft.nickname}
          maxLength={20}
          aria-label={t("nickname")}
          onChange={(event) => updateDraft({ nickname: event.target.value })}
          disabled={status === "saving"}
          className="w-full sm:w-64"
        />
      </SettingsField>
      <SettingsField title={t("gender")}>
        <Select
          value={draft.gender}
          onValueChange={(value) => updateDraft({ gender: value as MemberGender })}
          disabled={status === "saving"}
        >
          <SelectTrigger aria-label={t("gender")} className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="male">{t("genderMale")}</SelectItem>
            <SelectItem value="female">{t("genderFemale")}</SelectItem>
          </SelectContent>
        </Select>
      </SettingsField>
      <SettingsField title={t("myTimeZone")} description={t("myTimeZoneDesc")}>
        <Select
          value={draft.timeZone ?? "auto"}
          onValueChange={(value) => updateDraft({ timeZone: value === "auto" ? null : value })}
          disabled={status === "saving"}
        >
          <SelectTrigger aria-label={t("myTimeZone")} className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="auto">
              {deviceTimeZone == null
                ? t("timeZoneAuto")
                : t("timeZoneAutoDetected", { timeZone: deviceTimeZone })}
            </SelectItem>
            {TIME_ZONES.map((timeZone) => (
              <SelectItem key={timeZone} value={timeZone}>
                {timeZone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsField>
      {partner != null ? (
        <SettingsField title={t("partner")} description={t("partnerDesc")}>
          <p className="text-sm text-text sm:text-right">{partner.nickname}</p>
        </SettingsField>
      ) : null}
      <SettingsSectionActions
        dirty={dirty}
        pending={status === "saving"}
        error={error}
        serverChanged={serverChanged}
        saveDisabled={serverChanged}
        onSave={() => void handleSave()}
        onCancel={handleCancel}
      />
    </SettingsSection>
  );
}
