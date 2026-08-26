import multiprocessing

bind = "127.0.0.1:5000"
workers = max(2, multiprocessing.cpu_count())
accesslog = "-"
errorlog = "-"
capture_output = True
enable_stdio_inheritance = True
loglevel = "info"
timeout = 120
graceful_timeout = 30
