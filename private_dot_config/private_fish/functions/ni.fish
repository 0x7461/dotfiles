function ni --description 'Start niri as a dbus session'
    exec dbus-run-session -- niri --session
end
