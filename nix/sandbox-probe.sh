canary="${1:?usage: sandbox-probe <canary-file>}"

if { exec 3<>/dev/tcp/1.1.1.1/80; } 2>/dev/null; then
  echo NET_OK
  exec 3<&- 3>&-
else
  echo NET_DENIED
fi

if { exec 4<"$canary"; } 2>/dev/null; then
  echo CANARY_READ_OK
  exec 4<&-
else
  echo CANARY_READ_DENIED
fi

printf 'SECRET=[%s]\n' "${SANDBOX_PROBE_SECRET-}"

if { printf x > .sandbox-probe-write; } 2>/dev/null; then
  echo CWD_WRITABLE
else
  echo CWD_READONLY
fi
