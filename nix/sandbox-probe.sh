canary="${1:?usage: sandbox-probe <canary-file> <tcp-port>}"
port="${2:?usage: sandbox-probe <canary-file> <tcp-port>}"

if { exec 3<>/dev/tcp/127.0.0.1/"$port"; } 2>/dev/null; then
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

if { printf x > "${TMPDIR:-/tmp}/.sandbox-probe-write"; } 2>/dev/null; then
  echo TMPDIR_WRITABLE
else
  echo TMPDIR_READONLY
fi

if { exec 5</etc/passwd; } 2>/dev/null; then
  echo ETC_READ_OK
  exec 5<&-
else
  echo ETC_READ_DENIED
fi

if { exec 5</usr/bin/env; } 2>/dev/null; then
  echo USR_READ_OK
  exec 5<&-
else
  echo USR_READ_DENIED
fi

if { exec 5</proc/self/environ; } 2>/dev/null; then
  echo PROC_READ_OK
  exec 5<&-
else
  echo PROC_READ_DENIED
fi
