import { useRef, useEffect } from "react";
import { motion } from "framer-motion";
import type { CastMember } from "../types";
import { useImageSrc } from "../hooks/useImageSrc";

// ── Single avatar item ──────────────────────────────────────────────────

function CastAvatar({ member, avatarSize, hideSubName }: { member: CastMember; seriesType?: string; avatarSize: number; hideSubName: boolean }) {
  const [person] = member;
  const imgSrc = useImageSrc(person.image_cache ?? null);

  const imageUrl = imgSrc ?? person.image_url;
  const initial = person.name.charAt(0).toUpperCase();

  // name = 角色(anime)/演员(tv), role_name = 声优(anime)/角色(tv)
  const primaryName = person.name;
  const secondaryName = person.role_name;

  return (
    <motion.div
      whileHover={{ scale: 1.12 }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        width: avatarSize + 8,
        flexShrink: 0,
        cursor: "default",
      }}
    >
      {/* Avatar circle */}
      <motion.div
        whileHover={{
          boxShadow: "0 0 12px var(--color-accent-dim)",
        }}
        style={{
          width: avatarSize,
          height: avatarSize,
          borderRadius: "50%",
          overflow: "hidden",
          flexShrink: 0,
          background: imageUrl ? undefined : "var(--color-accent-dim)",
          backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!imageUrl && (
          <span
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "rgba(196,126,58,0.5)",
              userSelect: "none",
            }}
          >
            {initial}
          </span>
        )}
      </motion.div>

      {/* Primary name */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "var(--color-text)",
          textAlign: "center",
          lineHeight: 1.2,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          width: "100%",
        }}
        title={primaryName}
      >
        {primaryName || "—"}
      </span>

      {/* Secondary name */}
      {secondaryName && !hideSubName && (
        <span
          style={{
            fontSize: 10,
            color: "var(--color-text-muted)",
            textAlign: "center",
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            width: "100%",
            marginTop: -2,
          }}
          title={secondaryName}
        >
          {secondaryName}
        </span>
      )}
    </motion.div>
  );
}

// ── CastStrip ───────────────────────────────────────────────────────────

interface CastStripProps {
  castMembers: CastMember[];
  avatarSize?: number;
  hideSubName?: boolean;
}

export default function CastStrip({ castMembers, avatarSize = 48, hideSubName = false }: CastStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  // ── Wheel → horizontal scroll (same strategy as poster wall / episode strip) ──
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      el.scrollBy({ left: e.deltaY * 2.5, behavior: "auto" });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [castMembers]);

  if (!castMembers || castMembers.length === 0) return null;

  return (
    <div
      ref={stripRef}
      className="cast-strip"
      style={{
        overflowX: "auto",
        overflowY: "hidden",
        scrollbarWidth: "none",
        display: "flex",
        gap: 14,
        padding: "4px 0",
      }}
    >
      <style>{`.cast-strip::-webkit-scrollbar { display: none; }`}</style>
      {castMembers
        .slice()
        .sort((a, b) => a[1] - b[1])
        .map((member) => (
          <CastAvatar
            key={member[0].id}
            member={member}
            avatarSize={avatarSize}
            hideSubName={hideSubName}
          />
        ))}
    </div>
  );
}
