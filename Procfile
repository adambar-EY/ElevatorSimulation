    web: uvicorn main:app --host 0.0.0.0 --port $PORT
    ```
    * `web:`: Declares this as the web process.
    * `uvicorn main:app`: Tells Uvicorn to run the `app` object found in the `main.py` file.
    * `--host 0.0.0.0`: Makes the server accessible externally within the Azure container. **Crucial**.
    * `--port $PORT`: Azure App Service injects the required port number into the `$PORT` environment variable. Uvicorn will listen on this port.

**2. Deployment Steps (Conceptual - using Azure Portal/CLI):**

These are the general steps. You can use the Azure Portal, Azure CLI, or VS Code Azure extensions.

1.  **Create Azure App Service Plan:**
    * Choose a region (e.g., West Europe, East US).
    * Select a pricing tier (e.g., Free, Basic, Standard - Free/Basic might be sufficient for testing).
    * Select the Operating System: **Linux**.
2.  **Create Azure App Service (Web App):**
    * Select a unique name for your app (e.g., `my-elevator-sim`). This becomes part of your URL (`<your-app-name>.azurewebsites.net`).
    * Publish: Choose **Code**.
    * Runtime stack: Select **Python** (choose a recent version like 3.9, 3.10, 3.11).
    * Operating System: **Linux**.
    * Region: Choose the same region as your App Service Plan.
    * Link it to the App Service Plan you created.
3.  **Configure Deployment:**
    * Go to your created App Service.
    * Navigate to "Deployment Center".
    * Choose a source: GitHub, Azure DevOps, Local Git, Zip Deploy, etc. (GitHub Actions is a good option for continuous deployment).
    * Follow the instructions to link your code repository or upload your code (ensure `requirements.txt` and `Procfile` are included at the root).
4.  **Configure WebSockets:**
    * Go to your App Service.
    * Navigate to "Configuration" -> "General settings".
    * Ensure the "Web sockets" option is turned **On**. (It's often on by default for Python apps).
    * Save the changes if you made any.
5.  **Update Frontend WebSocket URL:**
    * Once deployed, your app will be available at `https://<your-app-name>.azurewebsites.net`.
    * You **must** update the WebSocket URL in your `script.js` file. Since Azure App Service uses HTTPS by default, you should use the secure WebSocket protocol (`wss://`).
    * **Modify `script.js`:** Change the line where the WebSocket URL is defined:
        ```javascript
        // Inside connectWebSocket function in script.js

        // OLD: const url = wsUrlInput.value; // Or ws://localhost:5050/ws

        // NEW (Replace <your-app-name> with your actual App Service name):
        const url = `wss://<your-app-name>.azurewebsites.net/ws`;

        // Or, make it dynamic (more advanced):
        // const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // const url = `${wsProtocol}//${window.location.host}/ws`;

        console.log(`Attempting to connect to ${url}...`);
        try {
            websocket = new WebSocket(url);
        } // ... rest of the function
        ```
    * You'll need to redeploy the application after updating `script.js`.

**Summary:**

To deploy, you primarily need to add `requirements.txt` and `Procfile` to your project root, ensure your static files are correctly located relative to `main.py`, use Azure App Service (Linux, Python runtime), configure WebSockets, and critically, update the WebSocket URL in your frontend JavaScript to point to your deployed Azure app using `wss:/