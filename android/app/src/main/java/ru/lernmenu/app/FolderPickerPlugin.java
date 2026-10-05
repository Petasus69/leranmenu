package ru.lernmenu.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "FolderPicker")
public class FolderPickerPlugin extends Plugin {
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject empty = new JSObject();
            empty.put("files", new JSArray());
            call.resolve(empty);
            return;
        }

        Uri treeUri = data.getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException ignored) {
            // Доступ действует хотя бы до закрытия приложения.
        }

        bridge.execute(() -> {
            try {
                JSArray files = new JSArray();
                String rootId = DocumentsContract.getTreeDocumentId(treeUri);
                readDirectory(treeUri, rootId, "", files);
                JSObject response = new JSObject();
                response.put("files", files);
                call.resolve(response);
            } catch (Exception error) {
                call.reject("Не удалось прочитать выбранную папку", error);
            }
        });
    }

    private void readDirectory(Uri treeUri, String documentId, String relativePath, JSArray files) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId);
        String[] columns = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        };

        try (Cursor cursor = resolver.query(childrenUri, columns, null, null, null)) {
            if (cursor == null) return;
            int idColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int typeColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE);
            while (cursor.moveToNext()) {
                String childId = cursor.getString(idColumn);
                String name = cursor.getString(nameColumn);
                String mimeType = cursor.getString(typeColumn);
                String path = relativePath.isEmpty() ? name : relativePath + "/" + name;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType)) {
                    readDirectory(treeUri, childId, path, files);
                } else if (name.toLowerCase().endsWith(".md")) {
                    Uri fileUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childId);
                    JSObject file = new JSObject();
                    file.put("name", name);
                    file.put("path", path);
                    file.put("text", readText(resolver, fileUri));
                    files.put(file);
                }
            }
        }
    }

    private String readText(ContentResolver resolver, Uri uri) throws Exception {
        StringBuilder result = new StringBuilder();
        try (InputStream stream = resolver.openInputStream(uri);
             BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line).append('\n');
        }
        return result.toString();
    }
}
