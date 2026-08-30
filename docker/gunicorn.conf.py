bind = "127.0.0.1:5000"
# One worker: the agent runner keeps the run queue, live timeout, subprocess,
# and stop signal in this process. Extra workers split that state.
workers = 1
accesslog = "-"
errorlog = "-"
capture_output = True
enable_stdio_inheritance = True
loglevel = "info"
timeout = 120
graceful_timeout = 30
