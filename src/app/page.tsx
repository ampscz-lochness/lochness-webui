import * as React from 'react';
import Link from 'next/link'

export default function Home() {
    return (
        <div className="container mx-auto p-6 max-w-4xl">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-8 border-l-4 border-indigo-500 dark:border-indigo-400">
                <h2 className="text-2xl font-bold mb-4 text-indigo-600 dark:text-indigo-400">
                    👋 Welcome to Lochness WebUI.
                </h2>

                <p className="text-lg mb-3">
                    This portal allows configuring and monitoring Lochness, a data lake builder.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-6">
                    <Link href="/monitoring/daytracker">
                        <div className="h-full border border-l-4 border-l-emerald-500 rounded-lg p-4 hover:shadow-md transition-shadow bg-emerald-50/40 dark:bg-slate-700/50 dark:border-emerald-500">
                            <h3 className="text-xl mb-2 font-bold text-gray-700 dark:text-gray-300">
                                🗓️ Day Tracker
                            </h3>
                            <p className="text-base">
                                Review subject-level REDCap study events and modality timelines, including consent, screen-failure, and withdrawal status indicators.
                            </p>
                        </div>
                    </Link>

                    <Link href="/monitoring/sharepoint">
                        <div className="h-full border border-l-4 border-l-sky-500 rounded-lg p-4 hover:shadow-md transition-shadow bg-sky-50/40 dark:bg-slate-700/50 dark:border-sky-500">
                            <h3 className="text-xl mb-2 font-bold text-gray-700 dark:text-gray-300">
                                ☁️ SharePoint Tracker
                            </h3>
                            <p className="text-base">
                                Track SharePoint JSON files, actual files, and REDCap run sheets across EEG, MindLAMP QC, and Transcript modalities per subject.
                            </p>
                        </div>
                    </Link>

                    <Link href="/monitoring/logs">
                        <div className="h-full border border-l-4 border-l-teal-400 rounded-lg p-4 hover:shadow-md transition-shadow bg-teal-50/30 dark:bg-slate-700/50 dark:border-teal-500">
                            <h3 className="text-xl mb-2 font-bold text-gray-700 dark:text-gray-300">
                                📊 Monitoring &amp; Logs
                            </h3>
                            <p className="text-base">
                                Track performance metrics and health indicators of various systems.
                            </p>
                        </div>
                    </Link>

                    <Link href="/issues/failed-ingestions">
                        <div className="h-full border border-l-4 border-l-red-500 rounded-lg p-4 hover:shadow-md transition-shadow bg-red-50/30 dark:bg-slate-700/50 dark:border-red-500">
                            <h3 className="text-xl mb-2 font-bold text-gray-700 dark:text-gray-300">
                                ⚠️ Failed Data Ingestions
                            </h3>
                            <p className="text-base">
                                View Airflow DAG health for the last 24 hours — spot failing pipelines and confirm healthy ingestion status.
                            </p>
                        </div>
                    </Link>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    <Link href="/config">
                        <div className="border border-l-4 border-l-amber-400 rounded-lg p-3 hover:shadow-md transition-shadow bg-amber-50/30 dark:bg-slate-700/50 dark:border-amber-500">
                            <h3 className="text-base mb-1 font-bold text-gray-700 dark:text-gray-300">
                                🔍 Configuration
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                Add / Remove data sources, and manage data lake.
                            </p>
                        </div>
                    </Link>
                </div>

                <p className="text-base mt-4">
                    This project is under active development. Check back for updates or contribute on <Link href="https://github.com/dheshanm/lochness-webui" target="_blank" className="font-medium underline">GitHub</Link>.
                </p>
            </div>
        </div>
    );
}
