import * as vscode from 'vscode';
import { SlashCommands } from './commands/SlashCommands';
import { TabCompletionProvider } from './completion/TabCompletionProvider';
import { ContextEngine } from './context/ContextEngine';
import { MultiAgentOrchestrator } from './orchestrator/MultiAgentOrchestrator';
import { AIProviderManager } from './providers/AIProviderManager';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { ChatViewProvider } from './ui/ChatViewProvider';
import { InlineEditProvider } from './ui/InlineEditProvider';

function updateTabStatus(statusItem: vscode.StatusBarItem, enabled: boolean): void {
    statusItem.text = enabled ? '$(zap) Tab AI' : '$(circle-slash) Tab AI';
    statusItem.tooltip = enabled
        ? 'GiuseCoder Tab Completion: Active'
        : 'GiuseCoder Tab Completion: Disabled (click to toggle)';
    statusItem.backgroundColor = enabled ? undefined : new vscode.ThemeColor('statusBarItem.warningBackground');
}

async function openChatView(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.extension.giuseCoder');
    await vscode.commands.executeCommand('giuseCoder.chatView.focus');
}

export function activate(context: vscode.ExtensionContext): void {
    const aiProvider = new AIProviderManager(context);
    const contextEngine = new ContextEngine();
    const slashCommands = new SlashCommands(contextEngine);

    const openaiProvider = new OpenAIProvider(context);
    const orchestrator = new MultiAgentOrchestrator(aiProvider, openaiProvider);

    const chatViewProvider = new ChatViewProvider(context, aiProvider, contextEngine, slashCommands);
    chatViewProvider.setOrchestrator(orchestrator);
    chatViewProvider.setOpenaiProvider(openaiProvider);
    const inlineEditProvider = new InlineEditProvider(aiProvider, contextEngine);

    const webviewDisposable = vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider, {
        webviewOptions: {
            retainContextWhenHidden: true
        }
    });

    const tabProvider = new TabCompletionProvider(aiProvider);
    const tabDisposable = vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, tabProvider);

    const tabStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    tabStatusItem.command = 'giuseCoder.toggleTabCompletion';

    const tabCompletionEnabled = vscode.workspace
        .getConfiguration('giuseCoder.tabCompletion')
        .get<boolean>('enabled', true);
    updateTabStatus(tabStatusItem, tabCompletionEnabled);
    tabStatusItem.show();

    const openChatCommand = vscode.commands.registerCommand('giuseCoder.openChat', async () => {
        await openChatView();
        chatViewProvider.focusInput();
    });

    const clearChatCommand = vscode.commands.registerCommand('giuseCoder.clearChat', () => {
        chatViewProvider.clearChat();
    });

    const toggleTabCompletionCommand = vscode.commands.registerCommand('giuseCoder.toggleTabCompletion', async () => {
        const config = vscode.workspace.getConfiguration('giuseCoder.tabCompletion');
        const current = config.get<boolean>('enabled', true);
        const next = !current;

        await config.update('enabled', next, vscode.ConfigurationTarget.Global);
        updateTabStatus(tabStatusItem, next);

        if (!next) {
            tabProvider.clearCache();
        }

        void vscode.window.showInformationMessage(`GiuseCoder Tab Completion ${next ? 'enabled' : 'disabled'}.`);
    });

    const setApiKeyCommand = vscode.commands.registerCommand('giuseCoder.setAnthropicApiKey', async () => {
        const apiKey = await vscode.window.showInputBox({
            title: 'GiuseCoder: Anthropic API Key',
            prompt: 'Enter your Anthropic API key. It will be stored securely in VS Code Secret Storage.',
            password: true,
            ignoreFocusOut: true,
            placeHolder: 'sk-ant-...'
        });

        if (apiKey === undefined) {
            return;
        }

        const trimmed = apiKey.trim();
        if (!trimmed) {
            void vscode.window.showWarningMessage('API key was empty; nothing changed.');
            return;
        }

        try {
            await aiProvider.setApiKey(trimmed);
            void vscode.window.showInformationMessage('Anthropic API key saved successfully.');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error while saving API key.';
            void vscode.window.showErrorMessage(message);
        }
    });

    const setOpenaiApiKeyCommand = vscode.commands.registerCommand('giuseCoder.setOpenaiApiKey', async () => {
        const apiKey = await vscode.window.showInputBox({
            title: 'GiuseCoder: OpenAI API Key',
            prompt: 'Enter your OpenAI API key for Codex. It will be stored securely in VS Code Secret Storage.',
            password: true,
            ignoreFocusOut: true,
            placeHolder: 'sk-...'
        });

        if (apiKey === undefined) {
            return;
        }

        const trimmed = apiKey.trim();
        if (!trimmed) {
            void vscode.window.showWarningMessage('API key was empty; nothing changed.');
            return;
        }

        try {
            await openaiProvider.setApiKey(trimmed);
            void vscode.window.showInformationMessage('OpenAI API key saved successfully.');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error while saving API key.';
            void vscode.window.showErrorMessage(message);
        }
    });

    const inlineEditCommand = vscode.commands.registerCommand('giuseCoder.inlineEdit', async () => {
        await inlineEditProvider.runInlineEdit();
    });

    const fixErrorsCommand = vscode.commands.registerCommand('giuseCoder.fixErrors', async () => {
        await openChatView();
        chatViewProvider.focusInput('/fix ');
    });

    const explainSelectionCommand = vscode.commands.registerCommand('giuseCoder.explainSelection', async () => {
        await openChatView();
        chatViewProvider.focusInput('/explain ');
    });

    const refactorSelectionCommand = vscode.commands.registerCommand('giuseCoder.refactorSelection', async () => {
        await openChatView();
        chatViewProvider.focusInput('/refactor ');
    });

    const generateTestsCommand = vscode.commands.registerCommand('giuseCoder.generateTests', async () => {
        await openChatView();
        chatViewProvider.focusInput('/test ');
    });

    const configurationWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('giuseCoder.tabCompletion.enabled')) {
            const enabled = vscode.workspace
                .getConfiguration('giuseCoder.tabCompletion')
                .get<boolean>('enabled', true);
            updateTabStatus(tabStatusItem, enabled);
        }

        if (event.affectsConfiguration('giuseCoder.chat.model')) {
            const nextModel = vscode.workspace
                .getConfiguration('giuseCoder.chat')
                .get<string>('model', chatViewProvider.getModel());
            chatViewProvider.setModel(nextModel);
        }
    });

    context.subscriptions.push(
        webviewDisposable,
        tabDisposable,
        tabStatusItem,
        openChatCommand,
        clearChatCommand,
        toggleTabCompletionCommand,
        setApiKeyCommand,
        setOpenaiApiKeyCommand,
        inlineEditCommand,
        fixErrorsCommand,
        explainSelectionCommand,
        refactorSelectionCommand,
        generateTestsCommand,
        configurationWatcher
    );
}

export function deactivate(): void {}
