import multiprocessing

bind = "127.0.0.1:5000"
workers = max(2, multiprocessing.cpu_count())
accesslog = "/opt/agents44/logs/access.log"
errorlog = "/opt/agents44/logs/error.log"
capture_output = True
enable_stdio_inheritance = True
loglevel = "info"
