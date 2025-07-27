FROM --platform=linux/amd64 public.ecr.aws/lambda/python:3.13

USER root

WORKDIR ${LAMBDA_TASK_ROOT}

RUN dnf update -y && \
    dnf clean all && \
    rm -rf /var/cache/dnf

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir markitdown[all] && \
    pip list --format=freeze > /requirements.txt

COPY lambda_function.py lambda_function.py

RUN chmod 644 lambda_function.py && \
    chmod 644 /requirements.txt

RUN mkdir -p /tmp/markitdown && \
    chmod 700 /tmp/markitdown

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV TMPDIR=/tmp/markitdown

CMD ["lambda_function.lambda_handler"]
