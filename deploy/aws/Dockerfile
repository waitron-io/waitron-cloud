FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea
COPY tools-requirements.txt /opt/tools-requirements.txt
RUN pip install --disable-pip-version-check --root-user-action=ignore --no-cache-dir --only-binary=:all: --require-hashes -r /opt/tools-requirements.txt
ENV PYTHONDONTWRITEBYTECODE=1
COPY prepare.py tools-pins.json /opt/aws-tools/
RUN python -I -B /opt/aws-tools/prepare.py
COPY test-cli.tfrc /opt/test-cli.tfrc
ENV PATH="/opt/software/bin:${PATH}" \
    TF_CLI_CONFIG_FILE=/opt/test-cli.tfrc \
    TF_IN_AUTOMATION=1 \
    CHECKPOINT_DISABLE=1 \
    AWS_EC2_METADATA_DISABLED=true \
    AWS_SHARED_CREDENTIALS_FILE=/dev/null \
    AWS_CONFIG_FILE=/dev/null
USER 65532:65532
