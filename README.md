# Shop Manager

A shop-management app that runs from a public GitHub Pages link and saves shop records in the browser on each device. There is no laptop server, Firebase account, hosted database, or subscription.

## Publish the app on GitHub Pages

1. Create a new GitHub repository. Use `main` as its default branch.
2. From PowerShell, open this project folder and push the files to the new repository:

   ```powershell
   git init
   git add .
   git commit -m "Publish shop manager"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
   git push -u origin main
   ```

   Replace the last URL with the HTTPS URL shown on your GitHub repository. If Git says this folder is already a repository, skip `git init`; do not overwrite its existing remote.
3. On GitHub, open **Settings → Pages** and set the build/deployment source to **GitHub Actions**.
4. Open the repository's **Actions** tab and wait for **Deploy to GitHub Pages** to finish.
5. Open `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`. After future pushes to `main`, GitHub automatically rebuilds and publishes the app.

You do not need to double-click `start.bat` or leave your laptop running to use the published link. The app files are public, but shop records are **not** published to GitHub.

## Local data, devices, and backups

- Each browser has its own database. Data entered on your phone does not automatically appear on your laptop (and vice versa).
- On a device, records stay in that browser's IndexedDB. Clearing the browser's site data can erase them.
- Use **Backup → Download backup** regularly. To move or copy data to another device, open the Pages link there and use **Backup → Restore from a backup file**.
- Restore replaces all data in that browser.
- GitHub Pages requires an internet connection to first open or update the app. The saved data remains on that device.

If you already have a JSON backup from the laptop-hosted version, you can import it from **Backup**. If your only copy of the records is still in the laptop SQLite database, export a backup from the old app before replacing it.

## Features and development

- Browse products as a Pinterest-inspired visual outfit board; add quantities, prices, categories, and optional photos.
- Photos are resized and stored with the local product; each sale keeps its own product-photo snapshot.
- The Sales page combines customer, typed product name, quantity, sold-item photo, and payment entry with sales history. Select a catalog suggestion to deduct stock; manually typed items are saved to the sale without changing inventory.
- Record sales, payments, returns, stock movements, and customer balances.
- Export filtered sales to Excel (`.xlsx`), with separate item and invoice sheets.
- `npm install`, `npm test`, and `npm run build` install, test, and build the project locally.

Money is stored as integer minor units (poisha). Sale and return inventory updates use IndexedDB transactions.
