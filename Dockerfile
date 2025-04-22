# Use an official Python runtime as a parent image
FROM python:3.13-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container at /app
# Copy this first to leverage Docker cache
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Explicitly install gunicorn separately
# This makes it easier to spot errors related to gunicorn installation
RUN pip install --no-cache-dir gunicorn

# Copy the rest of the application code into the container at /app
# This includes main.py, elevator.py, index.html, and the static folder
COPY . .

# Verify gunicorn installation (optional, for debugging)
# This command will print the gunicorn version if installed correctly,
# or error out if it's not found by Python. Check build logs for this output.
RUN python -m gunicorn --version

# Make port 8000 available to the world outside this container
# Render automatically uses the port exposed here or specified in render.yaml
EXPOSE 8000

# Define environment variable (optional, Render can override)
ENV PORT=8000

# Run main.py when the container launches using Gunicorn
# Use the module path 'main:app' since WORKDIR is /app
# The application files (main.py, elevator.py, etc.) are directly in /app
CMD ["gunicorn", "-w", "4", "-k", "uvicorn.workers.UvicornWorker", "main:main", "-b", "0.0.0.0:8000"]