import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DirectorClient } from "#/api/director/director-client";
import { orgNodePath } from "#/constants/org-chart";
import { useNavigation } from "#/context/navigation-context";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { DIRECTOR_QUERY_KEYS } from "#/hooks/query/query-keys";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";

/**
 * Finds a team anywhere in the org by its title or directory and moves the
 * page to it. The page itself holds only the teams it draws.
 */
export function TeamSearch() {
  const { t } = useTranslation("openhands");
  const { backend } = useActiveBackend();
  const { navigate } = useNavigation();
  const listId = React.useId();
  const [text, setText] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [isOpen, setIsOpen] = React.useState(false);
  const query = text.trim();
  const found = useQuery({
    queryKey: DIRECTOR_QUERY_KEYS.search(backend.id, query),
    queryFn: () => DirectorClient.searchTeams(query),
    enabled: query !== "",
    retry: false,
    meta: { disableToast: true },
  });
  const teams = query === "" ? [] : (found.data ?? []);
  const go = (index: number) => {
    const team = teams[index];
    if (!team) return;
    navigate(orgNodePath(team.id));
    setText("");
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <label className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2 text-text-secondary focus-within:border-contrast">
        <Search width={14} height={14} aria-hidden="true" />
        <input
          type="search"
          role="combobox"
          aria-label={t(I18nKey.ORG_CHART$SEARCH)}
          aria-expanded={isOpen && query !== ""}
          aria-controls={listId}
          placeholder={t(I18nKey.ORG_CHART$SEARCH)}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((current) =>
                teams.length === 0
                  ? 0
                  : (current + step + teams.length) % teams.length,
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              go(active);
            } else if (event.key === "Escape") {
              setIsOpen(false);
            }
          }}
          className="w-40 bg-transparent text-xs text-contrast outline-none placeholder:text-muted"
        />
      </label>
      {isOpen && query !== "" && !found.isPending ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t(I18nKey.ORG_CHART$SEARCH)}
          className="absolute right-0 z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          {teams.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted">
              {t(
                found.isError
                  ? I18nKey.ORG_CHART$SEARCH_FAILED
                  : I18nKey.ORG_CHART$SEARCH_NONE,
              )}
            </li>
          ) : (
            teams.map((team, index) => (
              <li
                key={team.id}
                role="option"
                aria-selected={index === active}
                // Keeps the field focused, so the list is still there to
                // be clicked.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => go(index)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex cursor-pointer flex-col rounded-md px-2 py-1.5",
                  index === active ? "bg-surface-raised" : null,
                )}
              >
                <span className="truncate text-xs font-medium text-contrast">
                  {team.title}
                </span>
                <code className="truncate text-[11px] text-muted">
                  {team.path || "/"}
                </code>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
